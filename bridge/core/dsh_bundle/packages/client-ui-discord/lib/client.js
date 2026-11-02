// dsh-client-source-sha256: ace07de6f6868cb1324329276b3b0990c0010cd961bd5160d8363ffc3a8ca7fa
// dsh-style-sha256: 47e2883258b6ae649f15ddda512f0f33891bf7bbb21665a9f1663d989c0febd9
window.__ModuleLoader__.load({
 id: "@deepseek-ai/dsh-experimental-client-ui-discord",
 factory: (require) => {
 var module = { exports: {} };
 var exports = module.exports;
(function(){var s=document.createElement('style');s.setAttribute('data-dsh-plugin',"dsh-experimental-client-ui-discord");s.textContent=".dshc_page {\n  width: 100%;\n  height: 100%;\n  min-height: 0;\n  padding-top: var(--dsh-frame-top-clearance, 0px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  grid-template-columns: 220px minmax(0, 1fr) 240px;\n  font-size: 14px;\n  line-height: 1.5;\n  display: grid;\n}\n\n.dshc_notice {\n  max-width: 480px;\n  color: var(--dsw-alias-label-secondary);\n  text-align: center;\n  grid-column: 1 / -1;\n  place-self: center;\n  padding: 24px;\n}\n\n.dshc_rooms, .dshc_members {\n  background: var(--dsw-alias-bg-layer-2);\n  min-height: 0;\n  padding: 0 8px 16px;\n  overflow-y: auto;\n}\n\n.dshc_membersHead {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  flex: none;\n  height: 44px;\n  margin: 0 0 8px;\n}\n\n.dshc_groupTitle {\n  color: var(--dsw-alias-label-tertiary);\n  letter-spacing: .02em;\n  margin: 12px 8px 6px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.dshc_room {\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  align-items: center;\n  gap: 6px;\n  padding: 6px 8px;\n  display: flex;\n}\n\n.dshc_room:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_room:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_workspace {\n  padding-left: 22px;\n  font-size: .95em;\n}\n\n.dshc_roomLabel {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.dshc_activeCount {\n  color: var(--dsw-alias-label-tertiary);\n  flex-shrink: 0;\n  margin-left: auto;\n  font-size: 11px;\n}\n\n.dshc_activeBusy {\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshc_roomActive {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_hash {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 16px;\n}\n\n.dshc_chat {\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n}\n\n.dshc_chatHead {\n  -webkit-app-region: drag;\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  align-items: center;\n  gap: 6px;\n  height: 44px;\n  padding: 0 16px;\n  font-weight: 600;\n  display: flex;\n}\n\n.dshc_log {\n  flex: 1;\n  min-height: 0;\n  padding: 8px 0 12px;\n  overflow-y: auto;\n}\n\n.dshc_guide {\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  color: var(--dsw-alias-label-secondary);\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 10px;\n  margin: 16px;\n  padding: 14px 16px;\n  display: flex;\n}\n\n.dshc_empty {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 24px 16px;\n}\n\n.dshc_message {\n  grid-template-columns: 36px minmax(0, 1fr);\n  gap: 12px;\n  padding: 6px 16px;\n  display: grid;\n}\n\n.dshc_message:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_system .dshc_text {\n  color: var(--dsw-alias-label-tertiary);\n  font-style: italic;\n}\n\n.dshc_avatar {\n  corner-shape: round;\n  color: #fff;\n  border-radius: 50%;\n  place-items: center;\n  width: 36px;\n  height: 36px;\n  font-weight: 700;\n  display: grid;\n  position: relative;\n}\n\n.dshc_avatarImage {\n  object-fit: cover;\n  border-radius: 50%;\n  width: 100%;\n  height: 100%;\n  position: absolute;\n  inset: 0;\n}\n\n.dshc_avatarSmall {\n  width: 28px;\n  height: 28px;\n  font-size: 12px;\n}\n\n.dshc_avatarAnchor {\n  align-self: start;\n  position: relative;\n}\n\n.dshc_avatarButton {\n  cursor: pointer;\n  background: none;\n  border: 0;\n  border-radius: 50%;\n  padding: 0;\n}\n\n.dshc_avatarMenu {\n  z-index: 3;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  min-width: 140px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  flex-direction: column;\n  padding: 6px;\n  display: flex;\n  position: absolute;\n  top: calc(100% + 4px);\n  left: 0;\n}\n\n.dshc_avatarMenuTitle {\n  padding: 4px 8px;\n  font-weight: 700;\n}\n\n.dshc_avatarMenuItem {\n  border-radius: var(--dsw-radius-sm);\n  color: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 6px 8px;\n}\n\n.dshc_avatarMenuItem:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_messageBody {\n  min-width: 0;\n}\n\n.dshc_messageHead {\n  align-items: baseline;\n  gap: 6px;\n  display: flex;\n}\n\n.dshc_author {\n  font-weight: 600;\n}\n\n.dshc_time {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.dshc_tag {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-state-business-primary);\n  white-space: nowrap;\n  padding: 0 4px;\n  font-size: 10px;\n  font-weight: 600;\n}\n\n.dshc_edited {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.dshc_ownActions {\n  margin-left: auto;\n  margin-right: var(--channels-reply-clearance);\n  opacity: 0;\n  gap: 8px;\n  display: inline-flex;\n}\n\n.dshc_message:hover .dshc_ownActions, .dshc_ownActions:focus-within {\n  opacity: 1;\n}\n\n@media (hover: none) {\n  .dshc_ownActions {\n    opacity: 1;\n  }\n}\n\n.dshc_editBox {\n  flex-direction: column;\n  gap: 6px;\n  margin-top: 4px;\n  display: flex;\n}\n\n.dshc_editInput {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  min-height: 60px;\n  color: inherit;\n  font: inherit;\n  resize: vertical;\n  padding: 8px;\n}\n\n.dshc_editBar {\n  justify-content: flex-end;\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_editBar .dshc_time {\n  margin-right: auto;\n}\n\n.dshc_text {\n  white-space: normal;\n  overflow-wrap: anywhere;\n}\n\n.dshc_card {\n  border-left: 4px solid var(--dsw-alias-state-business-primary);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-layer-2);\n  margin-top: 4px;\n  padding: 6px 10px;\n}\n\n.dshc_card[data-state=\"failed\"] {\n  border-left-color: var(--dsw-alias-state-error-primary);\n}\n\n.dshc_card[data-state=\"retrying\"] {\n  border-left-color: var(--dsw-alias-state-warning-primary, #faa61a);\n}\n\n.dshc_cardButtons {\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  margin-top: 6px;\n  display: flex;\n}\n\n.dshc_cardTitle {\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.dshc_cardHead {\n  justify-content: space-between;\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_cardViews {\n  gap: 4px;\n  display: flex;\n}\n\n.dshc_cardViewButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  color: inherit;\n  cursor: pointer;\n  background: none;\n  padding: 0 6px;\n  font-size: 12px;\n}\n\n.dshc_cardViewButton[aria-pressed=\"true\"] {\n  background: var(--dsw-alias-bg-base);\n  font-weight: 600;\n}\n\n.dshc_permActions {\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  margin-top: 6px;\n  display: flex;\n}\n\n.dshc_permScope {\n  color: var(--dsw-alias-text-secondary);\n  flex-basis: 100%;\n  font-size: 12px;\n}\n\n.dshc_permStatus {\n  margin-top: 6px;\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.dshc_message {\n  --channels-reply-clearance: 36px;\n  position: relative;\n}\n\n.dshc_quote {\n  border-left: 2px solid var(--dsw-alias-label-tertiary);\n  min-width: 0;\n  color: var(--dsw-alias-label-tertiary);\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  gap: 6px;\n  margin-bottom: 2px;\n  padding-left: 8px;\n  font-size: 12px;\n  display: flex;\n  overflow: hidden;\n}\n\n.dshc_quoteDeleted {\n  font-style: italic;\n}\n\n.dshc_quoteAuthor {\n  flex: none;\n  font-weight: 600;\n}\n\n.dshc_replyButton {\n  opacity: 0;\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-layer-2);\n  cursor: pointer;\n  border: 0;\n  padding: 0 6px;\n  position: absolute;\n  top: 4px;\n  right: 16px;\n}\n\n.dshc_message:hover .dshc_replyButton, .dshc_message:focus-within .dshc_replyButton, .dshc_replyButton:focus-visible {\n  opacity: 1;\n}\n\n@media (hover: none) {\n  .dshc_replyButton {\n    opacity: 1;\n  }\n}\n\n.dshc_replyBar {\n  border-radius: var(--dsw-radius-sm);\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-layer-2);\n  align-items: center;\n  gap: 8px;\n  margin-bottom: 6px;\n  padding: 4px 8px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_replyBarText {\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n}\n\n.dshc_replyCancel {\n  color: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n}\n\n.dshc_working {\n  min-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n  padding: 0 16px;\n  font-size: 12px;\n}\n\n.dshc_composer {\n  padding: 0 16px 16px;\n  position: relative;\n}\n\n.dshc_composerBox {\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: var(--dsw-radius-xl);\n  background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-layer-2));\n  box-shadow: var(--dsw-shadow-lv1-blur);\n  flex-direction: column;\n  display: flex;\n  overflow: hidden;\n}\n\n.dshc_composerBox:focus-within {\n  border-color: var(--dsw-alias-label-tertiary);\n}\n\n.dshc_composerToolbar {\n  flex: none;\n  align-items: center;\n  gap: 4px;\n  padding: 4px 10px 10px;\n  display: flex;\n}\n\n.dshc_composerBox > .dshc_replyBar, .dshc_composerBox > .dshc_attachments {\n  margin: 10px 14px 0;\n}\n\n.dshc_mentionButton {\n  border-radius: var(--dsw-radius-full, 50%);\n  width: 32px;\n  height: 32px;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  padding: 0;\n  font-size: 18px;\n  display: inline-flex;\n}\n\n.dshc_mentionButton:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_sendButton {\n  border-radius: var(--dsw-radius-full, 50%);\n  width: 32px;\n  height: 32px;\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-label-primary);\n  font: inherit;\n  cursor: pointer;\n  border: 0;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  margin-left: auto;\n  padding: 0;\n  display: inline-flex;\n}\n\n.dshc_sendButton:disabled {\n  opacity: .45;\n  cursor: default;\n}\n\n.dshc_sendButton:focus-visible, .dshc_mentionButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_mentionPopup {\n  z-index: 2;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  max-height: 320px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  flex-direction: column;\n  padding: 6px;\n  display: flex;\n  position: absolute;\n  bottom: calc(100% - 8px);\n  left: 16px;\n  right: 16px;\n}\n\n.dshc_mentionPopup > [role=\"listbox\"] {\n  min-height: 0;\n  overflow-y: auto;\n}\n\n.dshc_mentionTitle {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 4px 8px 6px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.dshc_mentionItem {\n  border-radius: var(--dsw-radius-sm);\n  cursor: pointer;\n  align-items: center;\n  gap: 10px;\n  padding: 6px 8px;\n  display: flex;\n}\n\n.dshc_mentionActive {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_mentionName {\n  font-weight: 600;\n}\n\n.dshc_mentionMeta {\n  color: var(--dsw-alias-label-tertiary);\n  margin-left: auto;\n  font-size: 12px;\n}\n\n.dshc_mentionHint {\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-tertiary);\n  padding: 6px 8px 2px;\n  font-size: 11px;\n}\n\n.dshc_sendError {\n  color: var(--dsw-alias-state-error-primary);\n  margin-bottom: 6px;\n  font-size: 12px;\n}\n\n.dshc_input {\n  box-sizing: border-box;\n  width: 100%;\n  min-height: 52px;\n  max-height: 40vh;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  resize: none;\n  field-sizing: content;\n  background: none;\n  border: 0;\n  border-radius: 0;\n  flex: 1;\n  min-width: 0;\n  padding: 14px 16px 8px;\n  line-height: 1.5;\n}\n\n.dshc_input::placeholder {\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  overflow: hidden;\n}\n\n@media (width <= 600px) {\n  .dshc_composer {\n    padding: 0 8px 8px;\n  }\n\n  .dshc_composerToolbar {\n    padding: 4px 8px 8px;\n  }\n\n  .dshc_input {\n    padding: 12px 14px 8px;\n  }\n}\n\n.dshc_input:focus-visible {\n  outline: none;\n}\n\n.dshc_member {\n  border-radius: var(--dsw-radius-sm);\n  min-width: 0;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: 1;\n  align-items: center;\n  gap: 10px;\n  padding: 5px 8px;\n  display: flex;\n}\n\n.dshc_member:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_member:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_offline {\n  opacity: .5;\n}\n\n.dshc_memberAvatar {\n  position: relative;\n}\n\n.dshc_presence {\n  border: 2px solid var(--dsw-alias-bg-layer-2);\n  corner-shape: round;\n  background: #23a55a;\n  border-radius: 50%;\n  width: 10px;\n  height: 10px;\n  position: absolute;\n  bottom: -2px;\n  right: -2px;\n}\n\n.dshc_offline .dshc_presence {\n  background: var(--dsw-alias-label-tertiary);\n}\n\n.dshc_memberText {\n  flex-direction: column;\n  min-width: 0;\n  display: flex;\n}\n\n.dshc_memberName {\n  align-items: center;\n  gap: 6px;\n  display: flex;\n}\n\n.dshc_memberStatus {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n@media (width <= 900px) {\n  .dshc_page {\n    grid-template-columns: minmax(0, 1fr);\n  }\n\n  .dshc_rooms, .dshc_members {\n    display: none;\n  }\n}\n\n.dshc_groupHead {\n  justify-content: space-between;\n  align-items: center;\n  padding-right: 4px;\n  display: flex;\n}\n\n.dshc_iconButton {\n  border-radius: var(--dsw-radius-sm);\n  width: 22px;\n  height: 22px;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  font-size: 16px;\n  line-height: 1;\n}\n\n.dshc_iconButton:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_roomInput, .dshc_fieldInput {\n  box-sizing: border-box;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  font: inherit;\n  padding: 6px 8px;\n}\n\n.dshc_roomInput {\n  margin: 2px 0 6px;\n}\n\n.dshc_roomInput:focus-visible, .dshc_fieldInput:focus-visible, .dshc_iconButton:focus-visible, .dshc_linkButton:focus-visible, .dshc_addMemberButton:focus-visible, .dshc_primaryButton:focus-visible, .dshc_secondaryButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_addMemberButton {\n  box-sizing: border-box;\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  margin: 4px 0;\n  padding: 7px 8px;\n}\n\n.dshc_addMemberButton:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_settingsDivider {\n  border: 0;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n  width: 100%;\n  margin: 8px 0 4px;\n}\n\n.dshc_memberListDivider {\n  border: 0;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n  width: calc(100% - 16px);\n  margin: 12px 8px 2px;\n}\n\n.dshc_settingsButton {\n  text-align: left;\n  border-style: solid;\n  border-color: #0000;\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_settingsButton svg {\n  flex: none;\n}\n\n.dshc_memberRow {\n  border-radius: var(--dsw-radius-sm);\n  align-items: center;\n  display: flex;\n  position: relative;\n}\n\n.dshc_memberRow:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_memberRow .dshc_member:hover {\n  background: none;\n}\n\n.dshc_memberModel {\n  color: var(--dsw-alias-label-tertiary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 11px;\n  overflow: hidden;\n}\n\n.dshc_memberActions {\n  color: var(--dsw-alias-label-tertiary);\n  opacity: 0;\n  flex: none;\n  gap: 4px;\n  padding-right: 6px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_memberRow:hover .dshc_memberActions, .dshc_memberRow:focus-within .dshc_memberActions {\n  opacity: 1;\n}\n\n.dshc_linkButton {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 2px 4px;\n  font-size: 12px;\n}\n\n.dshc_linkButton:hover {\n  color: var(--dsw-alias-label-primary);\n  text-decoration: underline;\n}\n\n.dshc_dialogBackdrop {\n  z-index: 10;\n  background: #00000073;\n  place-items: center;\n  padding: 16px;\n  display: grid;\n  position: fixed;\n  inset: 0;\n}\n\n.dshc_dialog {\n  border-radius: var(--dsw-radius-lg);\n  width: min(460px, 100%);\n  max-height: calc(100vh - 32px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  box-shadow: var(--dsw-elevation-panel, 0 12px 32px #0000004d);\n  flex-direction: column;\n  gap: 12px;\n  padding: 20px;\n  display: flex;\n  overflow-y: auto;\n}\n\n.dshc_settingsDialog {\n  box-sizing: border-box;\n  height: min(70vh, 100dvh - 32px);\n  max-height: calc(100dvh - 32px);\n  overflow: hidden;\n}\n\n.dshc_settingsBody {\n  overscroll-behavior: contain;\n  flex: auto;\n  min-height: 0;\n  padding: 2px;\n  overflow-y: auto;\n}\n\n.dshc_settingsDialog > :not(.dshc_settingsBody) {\n  flex-shrink: 0;\n}\n\n.dshc_settingsFields {\n  flex-direction: column;\n  gap: 12px;\n  display: flex;\n}\n\n.dshc_settingsFeedback {\n  overflow-wrap: anywhere;\n  max-height: 20%;\n  overflow-y: auto;\n}\n\n.dshc_settingsDialog .dshc_dialogActions {\n  justify-content: space-between;\n}\n\n@media (width <= 599px) {\n  .dshc_settingsDialog {\n    height: calc(100dvh - 32px);\n    padding: 16px;\n  }\n}\n\n.dshc_avatarCropStage {\n  background: #000000a6;\n  padding: 20px;\n}\n\n.dshc_avatarCropFrame {\n  aspect-ratio: 1;\n  touch-action: none;\n  cursor: grab;\n  outline: 2px solid #fff;\n  width: min(256px, 100%);\n  margin: auto;\n  position: relative;\n  overflow: hidden;\n}\n\n.dshc_avatarCropFrame:active {\n  cursor: grabbing;\n}\n\n.dshc_avatarCropFrame img {\n  pointer-events: none;\n  user-select: none;\n  max-width: none;\n  position: absolute;\n}\n\n.dshc_dialogTitle {\n  margin: 0;\n  font-size: 16px;\n}\n\n.dshc_field {\n  color: var(--dsw-alias-label-secondary);\n  flex-direction: column;\n  gap: 4px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_field textarea {\n  resize: vertical;\n}\n\n.dshc_choiceRow {\n  flex-wrap: wrap;\n  gap: 12px;\n  display: flex;\n}\n\n.dshc_choiceColumn {\n  flex-direction: column;\n  gap: 12px;\n  display: flex;\n}\n\n.dshc_choiceColumn .dshc_choice {\n  grid-template-columns: max-content minmax(0, 1fr);\n  align-items: start;\n  display: grid;\n}\n\n.dshc_choice {\n  color: var(--dsw-alias-label-primary, inherit);\n  cursor: pointer;\n  align-items: center;\n  gap: 4px;\n  font-size: 13px;\n  display: inline-flex;\n}\n\n.dshc_dialogActions {\n  justify-content: flex-end;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_primaryButton, .dshc_secondaryButton {\n  border-radius: var(--dsw-radius-sm);\n  font: inherit;\n  cursor: pointer;\n  padding: 7px 14px;\n}\n\n.dshc_primaryButton {\n  color: #fff;\n  background: var(--dsw-alias-state-business-primary);\n  border: 0;\n}\n\n.dshc_primaryButton:disabled {\n  cursor: not-allowed;\n  opacity: .5;\n}\n\n.dshc_secondaryButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-primary);\n  background: none;\n}\n\n.dshc_memberFailed .dshc_memberStatus {\n  color: var(--dsw-alias-state-error-primary, #ed4245);\n}\n\n.dshc_memberFailed .dshc_presence {\n  background: #ed4245;\n}\n\n.dshc_mobileButton, .dshc_drawerBackdrop {\n  display: none;\n}\n\n.dshc_panelToggle {\n  border-radius: var(--dsw-radius-sm);\n  width: 28px;\n  height: 28px;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  justify-content: center;\n  align-items: center;\n  font-size: 16px;\n  line-height: 1;\n  display: inline-flex;\n}\n\n.dshc_panelToggle:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_panelToggle:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_panelToggleEnd {\n  margin-left: auto;\n}\n\n.dshc_capabilityMenu {\n  z-index: 4;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-base);\n  max-height: 260px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  gap: 2px;\n  padding: 5px;\n  display: grid;\n  position: absolute;\n  bottom: calc(100% + 4px);\n  left: 0;\n  right: 0;\n  overflow-y: auto;\n}\n\n.dshc_capabilityItem:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_capabilityHelp {\n  color: var(--dsw-alias-label-secondary);\n  white-space: normal;\n  margin: 6px;\n  font-size: 12px;\n}\n\n.dshc_capabilityItem:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_capabilityItem {\n  text-align: left;\n  cursor: pointer;\n  color: var(--dsw-alias-label-secondary);\n  white-space: nowrap;\n  background: none;\n  border: 0;\n  padding: 5px 8px;\n  font-size: 12px;\n  font-weight: 400;\n}\n\n@media (width >= 901px) {\n  .dshc_page.dshc_roomsHidden {\n    grid-template-columns: minmax(0, 1fr) 240px;\n  }\n\n  .dshc_page.dshc_membersHidden {\n    grid-template-columns: 220px minmax(0, 1fr);\n  }\n\n  .dshc_page.dshc_roomsHidden.dshc_membersHidden {\n    grid-template-columns: minmax(0, 1fr);\n  }\n\n  .dshc_roomsHidden > .dshc_rooms, .dshc_membersHidden > .dshc_members {\n    display: none;\n  }\n}\n\n@media (width <= 900px) {\n  .dshc_page {\n    position: relative;\n    overflow: hidden;\n  }\n\n  .dshc_mobileButton {\n    min-width: 40px;\n    min-height: 40px;\n    color: inherit;\n    font: inherit;\n    cursor: pointer;\n    background: none;\n    border: 0;\n    border-radius: 6px;\n    justify-content: center;\n    align-items: center;\n    display: inline-flex;\n  }\n\n  .dshc_mobileButton:last-child {\n    margin-left: auto;\n  }\n\n  .dshc_panelToggle {\n    display: none;\n  }\n\n  .dshc_drawerBackdrop {\n    z-index: 4;\n    background: #00000073;\n    border: 0;\n    display: block;\n    position: absolute;\n    inset: 0;\n  }\n\n  .dshc_rooms.dshc_drawerOpen, .dshc_members.dshc_drawerOpen {\n    z-index: 5;\n    box-sizing: border-box;\n    width: min(280px, 85%);\n    display: block;\n    position: absolute;\n    top: 0;\n    bottom: 0;\n    box-shadow: 0 0 24px #0000004d;\n  }\n\n  .dshc_rooms.dshc_drawerOpen {\n    left: 0;\n  }\n\n  .dshc_members.dshc_drawerOpen {\n    right: 0;\n  }\n\n  .dshc_memberActions {\n    opacity: 1;\n  }\n\n  .dshc_messageHead {\n    flex-wrap: wrap;\n  }\n}\n\n.dshc_avatarPicker {\n  flex-wrap: wrap;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_avatarOption {\n  cursor: pointer;\n  background: none;\n  border: 2px solid #0000;\n  border-radius: 50%;\n  padding: 2px;\n  display: grid;\n}\n\n.dshc_avatarOption[aria-checked=\"true\"] {\n  border-color: var(--dsw-alias-accent, #5865f2);\n}\n\n.dshc_taskBoardTrigger {\n  box-sizing: border-box;\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  height: 34px;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n  align-items: center;\n  gap: 8px;\n  margin: 4px 0;\n  padding: 7px 8px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_taskBoardTrigger:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_taskBoardTrigger:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_taskBoardSummary {\n  color: var(--dsw-alias-label-secondary);\n  text-align: right;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  flex: 1;\n  overflow: hidden;\n}\n\n.dshc_taskBoardDialog {\n  width: min(920px, 100%);\n  height: min(70vh, 100dvh - 32px);\n  overflow: hidden;\n}\n\n.dshc_taskBoardBody {\n  overscroll-behavior: contain;\n  flex: auto;\n  min-height: 0;\n  overflow-y: auto;\n}\n\n.dshc_taskBoardDialog > :not(.dshc_taskBoardBody) {\n  flex-shrink: 0;\n}\n\n.dshc_boardTabs {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  gap: 4px;\n  padding-bottom: 8px;\n  display: flex;\n  overflow-x: auto;\n}\n\n.dshc_boardTabs button {\n  border-radius: var(--dsw-radius-sm);\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n  padding: 7px 10px;\n  font-size: 13px;\n}\n\n.dshc_boardTabs button:hover, .dshc_boardTabs button[aria-selected=\"true\"] {\n  color: var(--dsw-alias-state-business-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_boardTabs button:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n  outline-offset: -2px;\n}\n\n.dshc_boardTabCount {\n  font-variant-numeric: tabular-nums;\n  margin-left: 4px;\n}\n\n.dshc_boardCardGrid {\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 12px;\n  margin: 6px 0 16px;\n  padding: 2px;\n  list-style: none;\n  display: grid;\n}\n\n.dshc_boardTaskCard {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-base);\n  border-radius: 12px;\n  flex-direction: column;\n  gap: 10px;\n  min-width: 0;\n  padding: 14px;\n  transition: transform .14s, box-shadow .14s;\n  display: flex;\n}\n\n.dshc_boardTaskCard[data-working=\"true\"] {\n  border-color: var(--dsw-alias-state-business-primary);\n}\n\n.dshc_boardTaskCard[data-status=\"done\"] {\n  filter: saturate(.25);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshc_boardTaskCard:hover {\n  transform: translateY(-2px);\n  box-shadow: 0 4px 12px #00000014;\n}\n\n.dshc_boardTaskHeader {\n  align-items: flex-start;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_boardTaskTitle {\n  overflow-wrap: anywhere;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  flex: 1;\n  font-size: 14px;\n  font-weight: 600;\n  line-height: 1.5;\n  display: -webkit-box;\n  overflow: hidden;\n}\n\n.dshc_boardTaskHeader .dshc_taskStatus {\n  border-radius: 999px;\n  padding: 3px 7px;\n  font-size: 11px;\n}\n\n.dshc_taskFiles {\n  justify-items: start;\n  gap: 4px;\n  min-width: 0;\n  font-size: 12px;\n  display: grid;\n}\n\n.dshc_taskFiles > span {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshc_taskFile {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  max-width: 100%;\n  color: var(--dsw-alias-label-primary);\n  display: block;\n  overflow: hidden;\n}\n\n.dshc_taskFiles > .dshc_linkButton {\n  font-size: inherit;\n}\n\n.dshc_taskFileForm {\n  grid-template-columns: minmax(0, 1fr) auto;\n  gap: 6px;\n  display: grid;\n}\n\n.dshc_taskFileForm select {\n  grid-column: 1 / -1;\n}\n\n.dshc_taskFileForm select, .dshc_taskFileForm input {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-base);\n  min-width: 0;\n  color: inherit;\n  border-radius: 4px;\n  padding: 5px;\n}\n\n.dshc_boardTaskCard .dshc_taskLinks {\n  justify-content: flex-end;\n  margin-top: auto;\n}\n\n.dshc_boardTabEmpty {\n  min-height: 240px;\n  color: var(--dsw-alias-label-secondary);\n  text-align: center;\n  justify-content: center;\n  align-items: center;\n  padding: 40px 16px;\n  display: flex;\n}\n\n@media (width <= 640px) {\n  .dshc_boardCardGrid {\n    grid-template-columns: minmax(0, 1fr);\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshc_boardTaskCard {\n    transition: none;\n  }\n\n  .dshc_boardTaskCard:hover {\n    transform: none;\n  }\n}\n\n.dshc_taskBoardScope {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n}\n\n.dshc_taskSection + .dshc_taskSection {\n  margin-top: 8px;\n}\n\n.dshc_taskSectionTitle {\n  color: var(--dsw-alias-label-secondary);\n  margin: 0 0 4px;\n  padding: 0 8px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.dshc_taskOwnerGroup + .dshc_taskOwnerGroup {\n  margin-top: 4px;\n}\n\n.dshc_taskOwnerName {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 0 8px;\n  font-size: 12px;\n}\n\n.dshc_taskList {\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n\n.dshc_taskRow {\n  border-radius: var(--dsw-radius-sm);\n  padding: 6px 8px;\n}\n\n.dshc_taskRow:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_taskLine {\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n  display: flex;\n}\n\n.dshc_taskTitle {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 13px;\n  overflow: hidden;\n}\n\n.dshc_taskMeta {\n  color: var(--dsw-alias-label-tertiary);\n  flex-wrap: wrap;\n  gap: 0 8px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_taskLinks {\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_taskEmpty {\n  color: var(--dsw-alias-label-tertiary);\n  margin: 0 8px;\n  font-size: 12px;\n}\n\n.dshc_taskDone summary {\n  cursor: pointer;\n}\n\n.dshc_taskStatus {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-state-business-primary);\n  flex: none;\n  padding: 0 4px;\n  font-size: 10px;\n  font-style: normal;\n  font-weight: 600;\n}\n\n.dshc_taskStatus[data-status=\"asked\"], .dshc_taskStatus[data-status=\"escalated\"], .dshc_taskStatus[data-status=\"declined\"], .dshc_taskStatus[data-status=\"rework\"] {\n  background: var(--dsw-alias-state-warning-primary, var(--dsw-alias-state-error-primary));\n}\n\n.dshc_taskStatus[data-status=\"done\"] {\n  background: var(--dsw-alias-label-tertiary);\n}\n\n.dshc_taskCard {\n  margin-top: 4px;\n  font-style: normal;\n}\n\n.dshc_taskMembers {\n  margin: 4px 0 0;\n  padding: 0;\n  list-style: none;\n}\n\n.dshc_taskMember {\n  align-items: center;\n  gap: 8px;\n  font-size: 13px;\n  display: flex;\n}\n\n.dshc_taskMemberName {\n  font-weight: 600;\n}\n\n.dshc_taskSub {\n  color: var(--dsw-alias-label-secondary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.dshc_focused {\n  background: var(--dsw-alias-interactive-bg-hover);\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n}\n\n.dshc_attachments {\n  flex-wrap: wrap;\n  gap: 6px;\n  margin: 4px 0;\n  display: flex;\n}\n\n.dshc_attachmentImage {\n  border-radius: 4px;\n  max-width: min(320px, 100%);\n  max-height: 240px;\n  display: block;\n}\n\n.dshc_imageAttachment {\n  align-content: start;\n  max-width: 100%;\n  display: grid;\n}\n\n.dshc_imagePreviewTrigger {\n  cursor: zoom-in;\n  background: none;\n  border: 0;\n  border-radius: 4px;\n  grid-area: 1 / 1;\n  padding: 0;\n}\n\n.dshc_imagePreviewTrigger:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n  outline-offset: 2px;\n}\n\n.dshc_imagePreviewDialog {\n  box-sizing: border-box;\n  width: fit-content;\n  max-width: 90vw;\n  max-height: 90dvh;\n  overflow: auto;\n}\n\n.dshc_imagePreviewHeader {\n  flex-shrink: 0;\n  justify-content: space-between;\n  align-items: center;\n  gap: 12px;\n  display: flex;\n}\n\n.dshc_imagePreviewHeader span {\n  overflow-wrap: anywhere;\n  min-width: 0;\n}\n\n.dshc_imagePreviewHeader button {\n  flex-shrink: 0;\n}\n\n.dshc_imagePreviewImage {\n  object-fit: contain;\n  align-self: center;\n  max-width: 100%;\n  min-height: 0;\n  max-height: 65dvh;\n  display: block;\n}\n\n.dshc_imagePreviewActions {\n  flex-wrap: wrap;\n  flex-shrink: 0;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_imagePreviewActions a {\n  text-decoration: none;\n}\n\n.dshc_imagePreviewActions button:disabled {\n  cursor: wait;\n  opacity: .5;\n}\n\n.dshc_attachmentActions {\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-base);\n  opacity: 0;\n  pointer-events: none;\n  flex-wrap: wrap;\n  grid-area: 1 / 1;\n  place-self: start end;\n  gap: 4px;\n  margin: 4px;\n  padding: 4px;\n  display: flex;\n}\n\n.dshc_attachmentActions a {\n  text-decoration: none;\n}\n\n.dshc_attachmentActions button:disabled {\n  cursor: wait;\n  opacity: .5;\n}\n\n.dshc_imageAttachment:hover .dshc_attachmentActions, .dshc_imageAttachment:focus-within .dshc_attachmentActions, .dshc_imageAttachment[data-copy-state=\"error\"] .dshc_attachmentActions, .dshc_imageAttachment[data-copy-state=\"copying\"] .dshc_attachmentActions, .dshc_imageAttachment[data-copy-state=\"copied\"] .dshc_attachmentActions {\n  opacity: 1;\n  pointer-events: auto;\n}\n\n@media (hover: none), (pointer: coarse), (width <= 768px) {\n  .dshc_attachmentActions {\n    opacity: 1;\n    pointer-events: auto;\n  }\n}\n\n.dshc_attachmentThumb {\n  object-fit: cover;\n  vertical-align: middle;\n  border-radius: 3px;\n  width: 32px;\n  height: 32px;\n}\n\n.dshc_attachmentFile {\n  background: var(--background-secondary, #7f7f7f26);\n  color: inherit;\n  border-radius: 4px;\n  align-items: center;\n  gap: 4px;\n  padding: 4px 8px;\n  text-decoration: none;\n  display: inline-flex;\n}\n\n.dshc_attachmentSize {\n  opacity: .6;\n  font-size: .85em;\n}\n\n.dshc_attachmentAudio {\n  flex-direction: column;\n  gap: 2px;\n  width: min(320px, 100%);\n  display: flex;\n}\n\n.dshc_attachmentAudio audio {\n  width: 100%;\n}\n\n.dshc_attachmentAudio a {\n  color: inherit;\n  text-decoration: none;\n}\n\n.dshc_attachmentFile {\n  overflow-wrap: anywhere;\n  max-width: 100%;\n}\n\n.dshc_chatHead button, .dshc_chatHead input, .dshc_chatHead select, .dshc_chatHead a, .dshc_chatHead [role=\"menu\"] {\n  -webkit-app-region: no-drag;\n}\n\n.dshc_text pre, .dshc_text table {\n  max-width: 100%;\n  overflow-x: auto;\n}\n";document.head.appendChild(s)})();
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
let react_jsx_runtime = require("react/jsx-runtime");
let react = require("react");
let mdast_util_from_markdown = require("mdast-util-from-markdown");
let mdast_util_gfm = require("mdast-util-gfm");
let mdast_util_math = require("mdast-util-math");
let micromark_extension_gfm = require("micromark-extension-gfm");
let micromark_extension_math = require("micromark-extension-math");
let micromark_util_character = require("micromark-util-character");
let micromark_util_symbol = require("micromark-util-symbol");
let micromark_factory_space = require("micromark-factory-space");
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
			async listTaskFiles(id) {
				return request(`collab/api/tasks/${id}/files`);
			},
			async attachTaskFile(id, attachmentId, label) {
				const { files } = await request(`collab/api/tasks/${id}/files`, json("POST", {
					attachment_id: attachmentId,
					label,
					role: "source"
				}));
				set({ tasks: (snapshot.tasks ?? []).map((task) => task.id === id ? {
					...task,
					files
				} : task) });
			},
			async reviewTask(id, verdict, note) {
				const { task } = await request(`collab/api/tasks/${id}/review`, json("POST", {
					verdict,
					note
				}));
				set({ tasks: (snapshot.tasks ?? []).map((row) => row.id === task.id ? task : row) });
			},
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
// src/client/mathCompatibility.ts
/** Extend upstream dollar-only math syntax with TeX delimiters while reusing its token vocabulary. */
const previousBackslash = function(code) {
	if (code !== micromark_util_symbol.codes.backslash) return true;
	const tail = this.events.at(-1);
	/* v8 ignore next -- a previous code necessarily has a preceding event. */
	if (tail === void 0) return false;
	return tail[1].type === micromark_util_symbol.types.characterEscape;
};
const tokenizeBackslashMathText = function(effects, ok, nok) {
	return start;
	function start(code) {
		/* v8 ignore next -- the text construct is dispatched only for a backslash. */
		if (code !== micromark_util_symbol.codes.backslash) return nok(code);
		effects.enter("mathText");
		effects.enter("mathTextSequence");
		effects.consume(code);
		return open;
	}
	function open(code) {
		if (code !== micromark_util_symbol.codes.leftParenthesis) return nok(code);
		effects.consume(code);
		effects.exit("mathTextSequence");
		return between;
	}
	function between(code) {
		if (code === micromark_util_symbol.codes.eof) return nok(code);
		if (code === micromark_util_symbol.codes.backslash) return effects.attempt({
			partial: true,
			tokenize: tokenizeClose
		}, close, afterCloseAttempt)(code);
		if ((0, micromark_util_character.markdownLineEnding)(code)) {
			effects.enter(micromark_util_symbol.types.lineEnding);
			effects.consume(code);
			effects.exit(micromark_util_symbol.types.lineEnding);
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
		return code === micromark_util_symbol.codes.backslash ? afterDataBackslash : data;
	}
	function afterDataBackslash(code) {
		if (code === micromark_util_symbol.codes.backslash) {
			effects.consume(code);
			return data;
		}
		return data(code);
	}
	function data(code) {
		if (code === micromark_util_symbol.codes.eof || code === micromark_util_symbol.codes.backslash || (0, micromark_util_character.markdownLineEnding)(code)) {
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
			if (code !== micromark_util_symbol.codes.backslash) return closeNok(code);
			closeEffects.enter("mathTextSequence");
			closeEffects.consume(code);
			return parenthesis;
		}
		function parenthesis(code) {
			if (code !== micromark_util_symbol.codes.rightParenthesis) return closeNok(code);
			closeEffects.consume(code);
			closeEffects.exit("mathTextSequence");
			return closeOk;
		}
	}
	function tokenizeOpen(openEffects, openOk, openNok) {
		return slash;
		function slash(code) {
			/* v8 ignore next -- the opening check follows a failed close attempt at a backslash. */
			if (code !== micromark_util_symbol.codes.backslash) return openNok(code);
			openEffects.enter(micromark_util_symbol.types.chunkString);
			openEffects.consume(code);
			return parenthesis;
		}
		function parenthesis(code) {
			if (code !== micromark_util_symbol.codes.leftParenthesis) return openNok(code);
			openEffects.consume(code);
			openEffects.exit(micromark_util_symbol.types.chunkString);
			return openOk;
		}
	}
};
function createMathFlow(marker, openMarker, closeMarker, multiline) {
	const tokenize = function(effects, ok, nok) {
		const self = this;
		let oddBackslashRun = false;
		const tail = self.events.at(-1);
		const initialSize = tail?.[1].type === micromark_util_symbol.types.linePrefix ? tail[2].sliceSerialize(tail[1], true).length : 0;
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
			return marker === micromark_util_symbol.codes.dollarSign ? afterDollarOpen : content;
		}
		function afterDollarOpen(code) {
			return code === micromark_util_symbol.codes.dollarSign ? nok(code) : content(code);
		}
		function content(code) {
			if (code === micromark_util_symbol.codes.eof) return nok(code);
			if (code === marker && (marker !== micromark_util_symbol.codes.dollarSign || !oddBackslashRun)) return effects.attempt({
				partial: true,
				tokenize: tokenizeClosingFence
			}, closed, afterClosingFenceAttempt)(code);
			if ((0, micromark_util_character.markdownLineEnding)(code)) return multiline ? effects.attempt(nonLazyContinuation, afterContinuation, nok)(code) : nok(code);
			return valueStart(code);
		}
		function afterClosingFenceAttempt(code) {
			return marker === micromark_util_symbol.codes.backslash ? effects.check({
				partial: true,
				tokenize: tokenizeOpeningFence
			}, nok, markerValueStart)(code) : markerValueStart(code);
		}
		function afterContinuation(code) {
			return effects.attempt({
				partial: true,
				tokenize: tokenizeClosingFence
			}, closed, initialSize ? (0, micromark_factory_space.factorySpace)(effects, content, micromark_util_symbol.types.linePrefix, initialSize + 1) : content)(code);
		}
		function valueStart(code) {
			effects.enter("mathFlowValue");
			oddBackslashRun = code === micromark_util_symbol.codes.backslash;
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
			if (code === micromark_util_symbol.codes.eof || code === marker || (0, micromark_util_character.markdownLineEnding)(code)) {
				effects.exit("mathFlowValue");
				return content(code);
			}
			oddBackslashRun = code === micromark_util_symbol.codes.backslash ? !oddBackslashRun : false;
			effects.consume(code);
			return value;
		}
		function closed(code) {
			effects.exit("mathFlow");
			return ok(code);
		}
		function tokenizeClosingFence(closeEffects, closeOk, closeNok) {
			return (0, micromark_factory_space.factorySpace)(closeEffects, sequenceStart, micromark_util_symbol.types.linePrefix, micromark_util_symbol.constants.tabSize);
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
				return (0, micromark_factory_space.factorySpace)(closeEffects, after, micromark_util_symbol.types.whitespace);
			}
			function after(code) {
				if (code !== micromark_util_symbol.codes.eof && !(0, micromark_util_character.markdownLineEnding)(code)) return closeNok(code);
				closeEffects.exit("mathFlowFence");
				return closeOk(code);
			}
		}
		function tokenizeOpeningFence(openEffects, openOk, openNok) {
			return sequenceStart;
			function sequenceStart(code) {
				/* v8 ignore next -- the opening check follows a failed close attempt at the marker. */
				if (code !== marker) return openNok(code);
				openEffects.enter(micromark_util_symbol.types.chunkString);
				openEffects.consume(code);
				return sequenceEnd;
			}
			function sequenceEnd(code) {
				if (code !== openMarker) return openNok(code);
				openEffects.consume(code);
				openEffects.exit(micromark_util_symbol.types.chunkString);
				return openOk;
			}
		}
	};
	return {
		concrete: true,
		name: marker === micromark_util_symbol.codes.dollarSign ? "sameLineDollarMathFlow" : "backslashMathFlow",
		tokenize
	};
}
const tokenizeNonLazyContinuation = function(effects, ok, nok) {
	const self = this;
	return start;
	function start(code) {
		/* v8 ignore next -- continuation constructs are attempted only after a line ending. */
		if (code === micromark_util_symbol.codes.eof) return ok(code);
		/* v8 ignore next -- continuation constructs are attempted only after a line ending. */
		if (!(0, micromark_util_character.markdownLineEnding)(code)) return nok(code);
		effects.enter(micromark_util_symbol.types.lineEnding);
		effects.consume(code);
		effects.exit(micromark_util_symbol.types.lineEnding);
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
const backslashMathFlow = createMathFlow(micromark_util_symbol.codes.backslash, micromark_util_symbol.codes.leftSquareBracket, micromark_util_symbol.codes.rightSquareBracket, true);
const sameLineDollarMathFlow = createMathFlow(micromark_util_symbol.codes.dollarSign, micromark_util_symbol.codes.dollarSign, micromark_util_symbol.codes.dollarSign, false);
const backslashMath = {
	flow: {
		[micromark_util_symbol.codes.backslash]: backslashMathFlow,
		[micromark_util_symbol.codes.dollarSign]: sameLineDollarMathFlow
	},
	text: { [micromark_util_symbol.codes.backslash]: backslashMathText }
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
	const tree = (0, mdast_util_from_markdown.fromMarkdown)(source, {
		extensions: [
			(0, micromark_extension_gfm.gfm)(),
			mathCompatibility(),
			(0, micromark_extension_math.math)()
		],
		mdastExtensions: [(0, mdast_util_gfm.gfmFromMarkdown)(), (0, mdast_util_math.mathFromMarkdown)()]
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
// src/client/ChannelsPage.module.css
var ChannelsPage_module_default = {
	"activeBusy": "dshc_activeBusy",
	"activeCount": "dshc_activeCount",
	"addMemberButton": "dshc_addMemberButton",
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
	"boardCardGrid": "dshc_boardCardGrid",
	"boardTabCount": "dshc_boardTabCount",
	"boardTabEmpty": "dshc_boardTabEmpty",
	"boardTabs": "dshc_boardTabs",
	"boardTaskCard": "dshc_boardTaskCard",
	"boardTaskHeader": "dshc_boardTaskHeader",
	"boardTaskTitle": "dshc_boardTaskTitle",
	"capabilityHelp": "dshc_capabilityHelp",
	"capabilityItem": "dshc_capabilityItem",
	"capabilityMenu": "dshc_capabilityMenu",
	"card": "dshc_card",
	"cardButtons": "dshc_cardButtons",
	"cardHead": "dshc_cardHead",
	"cardTitle": "dshc_cardTitle",
	"cardViewButton": "dshc_cardViewButton",
	"cardViews": "dshc_cardViews",
	"chat": "dshc_chat",
	"chatHead": "dshc_chatHead",
	"choice": "dshc_choice",
	"choiceColumn": "dshc_choiceColumn",
	"choiceRow": "dshc_choiceRow",
	"composer": "dshc_composer",
	"composerBox": "dshc_composerBox",
	"composerToolbar": "dshc_composerToolbar",
	"dialog": "dshc_dialog",
	"dialogActions": "dshc_dialogActions",
	"dialogBackdrop": "dshc_dialogBackdrop",
	"dialogTitle": "dshc_dialogTitle",
	"drawerBackdrop": "dshc_drawerBackdrop",
	"drawerOpen": "dshc_drawerOpen",
	"editBar": "dshc_editBar",
	"editBox": "dshc_editBox",
	"edited": "dshc_edited",
	"editInput": "dshc_editInput",
	"empty": "dshc_empty",
	"field": "dshc_field",
	"fieldInput": "dshc_fieldInput",
	"focused": "dshc_focused",
	"groupHead": "dshc_groupHead",
	"groupTitle": "dshc_groupTitle",
	"guide": "dshc_guide",
	"hash": "dshc_hash",
	"iconButton": "dshc_iconButton",
	"imageAttachment": "dshc_imageAttachment",
	"imagePreviewActions": "dshc_imagePreviewActions",
	"imagePreviewDialog": "dshc_imagePreviewDialog",
	"imagePreviewHeader": "dshc_imagePreviewHeader",
	"imagePreviewImage": "dshc_imagePreviewImage",
	"imagePreviewTrigger": "dshc_imagePreviewTrigger",
	"input": "dshc_input",
	"linkButton": "dshc_linkButton",
	"log": "dshc_log",
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
	"membersHidden": "dshc_membersHidden",
	"memberStatus": "dshc_memberStatus",
	"memberText": "dshc_memberText",
	"mentionActive": "dshc_mentionActive",
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
	"mobileButton": "dshc_mobileButton",
	"notice": "dshc_notice",
	"offline": "dshc_offline",
	"ownActions": "dshc_ownActions",
	"page": "dshc_page",
	"panelToggle": "dshc_panelToggle",
	"panelToggleEnd": "dshc_panelToggleEnd",
	"permActions": "dshc_permActions",
	"permScope": "dshc_permScope",
	"permStatus": "dshc_permStatus",
	"presence": "dshc_presence",
	"primaryButton": "dshc_primaryButton",
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
	"rooms": "dshc_rooms",
	"roomsHidden": "dshc_roomsHidden",
	"secondaryButton": "dshc_secondaryButton",
	"sendButton": "dshc_sendButton",
	"sendError": "dshc_sendError",
	"settingsBody": "dshc_settingsBody",
	"settingsButton": "dshc_settingsButton",
	"settingsDialog": "dshc_settingsDialog",
	"settingsDivider": "dshc_settingsDivider",
	"settingsFeedback": "dshc_settingsFeedback",
	"settingsFields": "dshc_settingsFields",
	"system": "dshc_system",
	"tag": "dshc_tag",
	"taskBoardBody": "dshc_taskBoardBody",
	"taskBoardDialog": "dshc_taskBoardDialog",
	"taskBoardScope": "dshc_taskBoardScope",
	"taskBoardSummary": "dshc_taskBoardSummary",
	"taskBoardTrigger": "dshc_taskBoardTrigger",
	"taskCard": "dshc_taskCard",
	"taskDone": "dshc_taskDone",
	"taskEmpty": "dshc_taskEmpty",
	"taskFile": "dshc_taskFile",
	"taskFileForm": "dshc_taskFileForm",
	"taskFiles": "dshc_taskFiles",
	"taskLine": "dshc_taskLine",
	"taskLinks": "dshc_taskLinks",
	"taskList": "dshc_taskList",
	"taskMember": "dshc_taskMember",
	"taskMemberName": "dshc_taskMemberName",
	"taskMembers": "dshc_taskMembers",
	"taskMeta": "dshc_taskMeta",
	"taskOwnerGroup": "dshc_taskOwnerGroup",
	"taskOwnerName": "dshc_taskOwnerName",
	"taskRow": "dshc_taskRow",
	"taskSection": "dshc_taskSection",
	"taskSectionTitle": "dshc_taskSectionTitle",
	"taskStatus": "dshc_taskStatus",
	"taskSub": "dshc_taskSub",
	"taskTitle": "dshc_taskTitle",
	"text": "dshc_text",
	"time": "dshc_time",
	"working": "dshc_working",
	"workspace": "dshc_workspace"
};
// src/client/Attachments.tsx
const isImage = (mime) => /^image\/(png|jpeg|gif|webp)$/.test(mime);
const isAudio = (mime) => mime.startsWith("audio/");
const size = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
function ImageAttachment({ attachment: a, t }) {
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
			const response = await fetch(attachmentUrl(a.id));
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
		href: attachmentUrl(a.id),
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
					src: attachmentUrl(a.id),
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
							src: attachmentUrl(a.id),
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
/** Single source for tab membership and board ordering; an empty list means all statuses. */
const BOARD_TABS = [
	{
		id: "all",
		label: "taskTabAll",
		statuses: []
	},
	{
		id: "working",
		label: "taskTabWorking",
		statuses: [
			"assigned",
			"accepted",
			"asked",
			"rework"
		],
		initial: true
	},
	{
		id: "review",
		label: "taskTabReview",
		statuses: [
			"returned",
			"declined",
			"escalated"
		]
	},
	{
		id: "done",
		label: "taskTabDone",
		statuses: ["done"]
	}
];
const groupOf = (status) => BOARD_TABS.findIndex((g) => g.statuses.includes(status));
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
function TaskBoard({ tasks, rooms, chatId, roomId, t, onOpen, onReview, onListFiles, onAttachFile }) {
	const [opened, setOpened] = (0, react.useState)(false);
	const [selectedTab, setSelectedTab] = (0, react.useState)(BOARD_TABS.find((tab) => tab.initial).id);
	const [reviewing, setReviewing] = (0, react.useState)();
	const [reason, setReason] = (0, react.useState)("");
	const [saving, setSaving] = (0, react.useState)(false);
	const [error, setError] = (0, react.useState)();
	const [addingTo, setAddingTo] = (0, react.useState)();
	const [candidates, setCandidates] = (0, react.useState)([]);
	const [selectedFile, setSelectedFile] = (0, react.useState)("");
	const [fileLabel, setFileLabel] = (0, react.useState)("");
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
	(0, react.useEffect)(() => {
		setOpened(false);
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
		(0, react_dom.flushSync)(close);
		onOpen(targetRoomId, messageId);
	};
	const openTotal = sections.reduce((n, s) => n + s.open, 0);
	const all = sections.reduce((n, s) => n + s.open + s.done, 0);
	const scopedTasks = sections.flatMap((section) => section.owners.flatMap((group) => [...group.open, ...group.done]));
	const activeTab = BOARD_TABS.find((tab) => tab.id === selectedTab);
	const matches = (task) => activeTab.statuses.length === 0 || activeTab.statuses.includes(task.status);
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
	const chooseFile = async (task) => {
		if (addingTo === task.id) {
			setAddingTo(void 0);
			return;
		}
		setError(void 0);
		try {
			const { candidates } = await onListFiles(task.id);
			setCandidates(candidates.filter((file) => !task.files?.some((linked) => linked.attachment_id === file.id && linked.role === "source")));
			setSelectedFile("");
			setFileLabel("");
			setAddingTo(task.id);
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		}
	};
	const saveFile = async (task) => {
		setSaving(true);
		setError(void 0);
		try {
			await onAttachFile(task.id, selectedFile, fileLabel.trim() || void 0);
			setAddingTo(void 0);
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
		"data-working": BOARD_TABS.find((tab) => tab.initial).statuses.includes(task.status),
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
							setReviewing(task.id);
							setReason("");
							setError(void 0);
						},
						children: t("taskSendBack")
					})] })
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.taskFiles,
				"aria-label": t("taskFiles"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("taskFiles") }),
					(task.files?.length ?? 0) === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("taskFilesEmpty") }) : task.files?.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						href: file.url,
						download: file.name,
						className: ChannelsPage_module_default.taskFile,
						title: file.name,
						children: file.name
					}, file.id)),
					onListFiles && onAttachFile && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.linkButton,
						onClick: () => {
							chooseFile(task);
						},
						children: t("taskFileAddSource")
					}),
					addingTo === task.id && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: ChannelsPage_module_default.taskFileForm,
						onSubmit: (event) => {
							event.preventDefault();
							saveFile(task);
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								"aria-label": t("taskFileChoose"),
								value: selectedFile,
								onChange: (event) => setSelectedFile(event.target.value),
								required: true,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t(candidates.length ? "taskFileChoose" : "taskFileNoCandidates")
								}), candidates.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: file.id,
									children: [
										file.name,
										" (#",
										file.message_id,
										")"
									]
								}, file.id))]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								"aria-label": t("taskFileLabel"),
								placeholder: t("taskFileLabel"),
								maxLength: 200,
								value: fileLabel,
								onChange: (event) => setFileLabel(event.target.value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								disabled: !selectedFile || saving,
								children: t("messageSave")
							})
						]
					})
				]
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
			})
		]
	}, task.id);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
		type: "button",
		className: ChannelsPage_module_default.taskBoardTrigger,
		"aria-label": t("taskBoardOpen"),
		"aria-haspopup": "dialog",
		"aria-expanded": opened,
		onClick: () => {
			setSelectedTab(BOARD_TABS.find((tab) => tab.initial).id);
			setOpened(true);
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("taskBoard") }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ChannelsPage_module_default.taskBoardSummary,
				children: all === 0 ? t("taskBoardNoTasks") : t("taskBoardSummary", {
					open: String(openTotal),
					done: String(all - openTotal)
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				"aria-hidden": "true",
				children: "›"
			})
		]
	}), opened && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: ChannelsPage_module_default.dialogBackdrop,
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
					const focusable = Array.from(event.currentTarget.querySelectorAll("button:not(:disabled):not([tabindex=\"-1\"]), input:not(:disabled), select:not(:disabled), a[href], [role=\"tabpanel\"]"));
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
								children: scopedTasks.filter((task) => tab.statuses.length === 0 || tab.statuses.includes(task.status)).length
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
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
	}), document.body)] });
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
	if (/^upload:[a-z0-9-]+\.png$/.test(avatar)) return `collab/avatars/uploads/${avatar.slice(7)}`;
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
function Avatar({ id, name, avatar, avatarVersion, small }) {
	const base = avatarSrc(avatar);
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
async function uploadAvatar(id, png) {
	const response = await fetch(`collab/api/members/${encodeURIComponent(id)}/avatar`, {
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
	const [name, setName] = (0, react.useState)(member?.name ?? "DSH");
	const [nameCustomized, setNameCustomized] = (0, react.useState)(member === void 0 ? false : member.nameCustomized);
	const [keepName, setKeepName] = (0, react.useState)(true);
	const [personas, setPersonas] = (0, react.useState)([]);
	const [personaSlug, setPersonaSlug] = (0, react.useState)("");
	const [persona, setPersona] = (0, react.useState)(member?.persona ?? "");
	const [modelKey, setModelKey] = (0, react.useState)(member?.model ? member.model.provider + SEP + member.model.model : "");
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
				const updated = await uploadAvatar(member.id, png);
				setAvatar(updated.avatar ?? "");
			} else {
				setPendingPng(png);
				setAvatar("");
			}
			setPreview(png ? `data:image/png;base64,${png}` : void 0);
		} catch (reason) {
			const message = reason instanceof Error ? reason.message : String(reason);
			setError(message === "avatar-png" ? t("memberAvatarPngError") : message === "avatar-size" ? t("memberAvatarSizeError") : message === "avatar-convert" ? t("memberAvatarConvertError") : message);
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
		if (busy || cropImage) return;
		const [provider, model] = modelKey === "" ? [] : modelKey.split(SEP);
		setBusy(true);
		setError(void 0);
		const identity = nameCustomized === void 0 ? {} : { nameCustomized };
		onSubmit(type === "cli" ? {
			name: name.trim(),
			...identity,
			persona,
			avatar,
			...pendingPng ? { avatarPng: pendingPng } : {},
			cli,
			permissionPreset: preset
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
		}).then(onClose).catch((reason) => {
			setError(reason instanceof Error ? reason.message : String(reason));
		}).finally(() => {
			setBusy(false);
		});
	};
	const current = member?.model ? member.model.provider + SEP + member.model.model : void 0;
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
function ChannelSettingsDialog({ room, members, effectiveLead, renameRoom, setDispatchMode, setMaxRelay, setLead, setWorkspacePath, renewRoom, t, onClose }) {
	const [tab, setTab] = (0, react.useState)("basic");
	const [name, setName] = (0, react.useState)(room.name);
	const [mode, setMode] = (0, react.useState)(room.dispatch_mode ?? "mixed");
	const [relay, setRelay] = (0, react.useState)(String(room.max_relay ?? RELAY_CAP_MIN));
	const [lead, setLeadDraft] = (0, react.useState)(effectiveLead);
	const [directory, setDirectory] = (0, react.useState)(room.workspace_path ?? "");
	const [saved, setSaved] = (0, react.useState)({
		name: room.name,
		mode: room.dispatch_mode ?? "mixed",
		relay: String(room.max_relay ?? RELAY_CAP_MIN),
		lead: effectiveLead,
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
				[target]: error instanceof Error ? error.message : String(error)
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
											disabled: true,
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
											workspace: error instanceof Error ? error.message : String(error)
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
/** Touch or narrow screens get the short composer placeholder (the long one wraps beside the send button). */
function compactComposer() {
	return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none), (max-width: 600px)").matches;
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
	const shown = typeof card?.brief === "string" && cardView === "brief" ? card.brief : message.text;
	const markdown = (0, react.useMemo)(() => softBreaksToHard(shown), [shown]);
	const classes = [
		ChannelsPage_module_default.message,
		message.author_kind === "system" ? ChannelsPage_module_default.system : "",
		focused ? ChannelsPage_module_default.focused : ""
	].filter(Boolean).join(" ");
	const anchored = card?.kind === "task" ? [] : tasks.filter((task) => task.assign_msg_id === message.id);
	const anchoredIds = new Set(anchored.map((task) => task.id));
	const taskCards = anchored.filter((task) => task.parent_task === null || !anchoredIds.has(task.parent_task));
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: classes,
		"data-message-id": message.id,
		children: [
			member === void 0 || message.author_kind === "system" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
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
								name: message.name,
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
					}) : card === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [message.text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.text,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
							text: markdown,
							labels
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AttachmentList, {
						attachments: message.attachments,
						t
					})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
									text: markdown,
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
					}),
					taskCards.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.card,
						"data-anchored-task": task.id,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
							taskId: task.id,
							tasks,
							t
						})
					}, task.id))
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
					avatarVersion: m.avatarVersion,
					small: true
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: m.error ? `${ChannelsPage_module_default.presence} ${ChannelsPage_module_default.errorPresence}` : ChannelsPage_module_default.presence })]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ChannelsPage_module_default.memberText,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: ChannelsPage_module_default.memberName,
						children: [m.name, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(KindTag, {
							name: m.name,
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
function ChannelsPage({ useChannels, selectRoom, send, reviewTask, listTaskFiles, attachTaskFile, createRoom, renameRoom, listModels, listClis, listPersonas, addMember, updateMember, removeMember, setLead, setWorkspacePath, renewRoom, setDispatchMode, setMaxRelay, decidePermission, retryMessage, editMessage, withdrawMessage, openModelSettings, t }) {
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
	const [settingsOpen, setSettingsOpen] = (0, react.useState)(false);
	const settingsButtonRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		if (!settingsOpen) return;
		const opener = settingsButtonRef.current;
		return () => {
			opener?.focus();
		};
	}, [settingsOpen]);
	(0, react.useEffect)(() => {
		setSettingsOpen(false);
	}, [state.roomId]);
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
	const channelId = room?.parent_id ?? room?.id;
	const visibleMembers = state.members.filter((m) => !m.rooms?.length || channelId !== void 0 && m.rooms.includes(channelId));
	const openTaskOwners = new Set((state.tasks ?? []).filter((t) => [
		"assigned",
		"accepted",
		"asked",
		"rework"
	].includes(t.status)).map((t) => t.owner));
	const busy = /* @__PURE__ */ new Set([...state.roomId === void 0 ? [] : state.thinking[String(state.roomId)] ?? [], ...openTaskOwners]);
	const byId = new Map(visibleMembers.map((m) => [m.id, m]));
	const typingNames = (state.roomId === void 0 ? [] : state.thinking[String(state.roomId)] ?? []).map((id) => byId.get(id)?.name ?? id);
	const mention = activeMention(draft, caret);
	const candidates = mention === void 0 || mention.start === dismissedAt ? [] : rankMembers(visibleMembers, mention.query);
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
		if (draft === "/" && !capabilitiesDismissed && !isImeEnter(event)) {
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
		if (event.key === "Enter" && !event.shiftKey && !isImeEnter(event)) {
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
						children: [!visibleMembers.some((m) => m.kind !== "human") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
										onRemove: (index) => {
											const roomId = state.roomId;
											setPendingFiles((previous) => ({
												...previous,
												[roomId]: (previous[roomId] ?? []).filter((_, i) => i !== index)
											}));
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										ref: inputRef,
										className: ChannelsPage_module_default.input,
										rows: 1,
										enterKeyHint: "send",
										value: draft,
										disabled: state.roomId === void 0 || sending[state.roomId] === true,
										placeholder: t(compactComposer() ? "placeholderShort" : "placeholder", { room: room?.name ?? "" }),
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
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: drawer === "members" ? `${ChannelsPage_module_default.members} ${ChannelsPage_module_default.drawerOpen}` : ChannelsPage_module_default.members,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.membersHead,
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						ref: settingsButtonRef,
						type: "button",
						className: `${ChannelsPage_module_default.addMemberButton} ${ChannelsPage_module_default.settingsButton}`,
						disabled: room === void 0,
						onClick: () => {
							setDrawer(void 0);
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskBoard, {
						tasks: state.tasks ?? [],
						rooms: state.rooms,
						chatId: state.taskChat,
						roomId: state.roomId,
						t,
						onOpen: openMessage,
						onReview: reviewTask,
						onListFiles: listTaskFiles,
						onAttachFile: attachTaskFile
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { className: ChannelsPage_module_default.memberListDivider }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemberGroup, {
						title: t("agents", { count: String(visibleMembers.filter((m) => m.kind !== "human").length) }),
						members: visibleMembers.filter((m) => m.kind !== "human"),
						busy,
						onPick: pickFromList,
						onEdit: setDialog,
						onRemove: confirmRemove,
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
// src/client/locales.ts
/** Channel panel dictionaries. */
/** Locale namespace owned by the channel panel. */
const NS = "discord-channels";
/** Simplified Chinese dictionary and key source. */
const zh = {
	copyCode: "复制代码",
	copiedCode: "已复制",
	attachmentDownload: "下载",
	attachmentCopy: "复制图片",
	attachmentCopying: "复制中…",
	attachmentCopied: "已复制",
	attachmentCopyError: "复制失败，请下载图片后保存或复制。",
	footnotes: "脚注",
	panel: "频道",
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
	capabilityDmHelp: "在支持私信的平台打开与角色的私聊。角色也可向配置中的用户发送私信；DSH 频道页目前没有私信入口。",
	taskTabLabel: "按任务状态筛选",
	taskTabAll: "全部",
	taskTabWorking: "进行中",
	taskTabReview: "待验收",
	taskTabDone: "已完成",
	taskTabEmpty: "「{tab}」下没有任务",
	taskBoard: "任务板",
	taskBoardSummary: "进行中 {open} · 已完成 {done}",
	taskBoardOpen: "打开任务板",
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
	taskFiles: "交付文件",
	taskFilesEmpty: "暂无交付文件",
	taskFileSource: "原文件",
	taskFileDeliverable: "新文件",
	taskFileAddSource: "关联原文件",
	taskFileChoose: "选择已上传的文件",
	taskFileNoCandidates: "本频道还没有可关联的文件",
	taskFileLabel: "备注（可选）",
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
	placeholderShort: "发消息到 #{room}",
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
	sendButton: "发送",
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
	memberName: "名字（@ 时用）",
	memberOptional: "可选：自定义名字、性格与说话风格、职责",
	memberNoPersona: "默认不附加角色人设，可以直接开始工作。",
	memberKeepName: "保留我的名字",
	memberPersonaNone: "不使用人设",
	memberPersonaLibrary: "从人设库选择",
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
	attachmentDownload: "Download",
	attachmentCopy: "Copy image",
	attachmentCopying: "Copying…",
	attachmentCopied: "Copied",
	attachmentCopyError: "Could not copy. Download the image to save or copy it.",
	footnotes: "Footnotes",
	taskTabLabel: "Filter tasks by status",
	taskTabAll: "All",
	taskTabWorking: "In progress",
	taskTabReview: "Awaiting review",
	taskTabDone: "Done",
	taskTabEmpty: "No tasks in {tab}",
	taskBoard: "Task board",
	taskBoardSummary: "In progress {open} · Done {done}",
	taskBoardOpen: "Open task board",
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
	taskFiles: "Task files",
	taskFilesEmpty: "No files delivered yet",
	taskFileSource: "Original",
	taskFileDeliverable: "Result",
	taskFileAddSource: "Link original file",
	taskFileChoose: "Choose an uploaded file",
	taskFileNoCandidates: "No files from this channel",
	taskFileLabel: "Note (optional)",
	lead: "Primary role",
	leadNone: "No role is available",
	durSeconds: "{n}s",
	durMinutes: "{n} min",
	durHours: "{h} h {m} min",
	panel: "Channels",
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
	placeholderShort: "Message #{room}",
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
	sendButton: "Send",
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
	memberName: "Name (used for @)",
	memberOptional: "Optional: name, personality, speaking style and responsibilities",
	memberNoPersona: "Ready to work without a persona.",
	memberKeepName: "Keep my name",
	memberPersonaNone: "No persona",
	memberPersonaLibrary: "Choose from persona library",
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
		reviewTask: channels.actions.reviewTask,
		listTaskFiles: channels.actions.listTaskFiles,
		attachTaskFile: channels.actions.attachTaskFile,
		retrySend: channels.actions.retrySend,
		dismissSend: channels.actions.dismissSend,
		loadOlder: channels.actions.loadOlder,
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
