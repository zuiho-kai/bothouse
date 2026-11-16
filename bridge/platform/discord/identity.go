package discord

// Ready writes the bot's own IDs on discordgo's event goroutine while
// MessageCreate, GuildCreate and command registration read them on others
// (upstream cc-connect fixed the same race in platform/discord with
// identity_race_test.go). Every access goes through these helpers.
// identityMu is its own lock so a reader already holding p.mu cannot deadlock.

func (p *Platform) setIdentity(botID, appID string) {
	p.identityMu.Lock()
	p.botID, p.appID = botID, appID
	p.identityMu.Unlock()
}

func (p *Platform) setAppID(appID string) {
	p.identityMu.Lock()
	p.appID = appID
	p.identityMu.Unlock()
}

func (p *Platform) selfID() string {
	p.identityMu.RLock()
	defer p.identityMu.RUnlock()
	return p.botID
}

func (p *Platform) selfAppID() string {
	p.identityMu.RLock()
	defer p.identityMu.RUnlock()
	return p.appID
}
