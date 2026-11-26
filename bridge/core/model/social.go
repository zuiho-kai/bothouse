package model

import "time"

// Moment is one post on the bot's own timeline.
type Moment struct {
	ID      string    `json:"id"`   // platform id, used to delete or replace it; "" when unknown
	Text    string    `json:"text"` // the words, as posted
	Time    time.Time `json:"time"` // when it was posted; zero when the platform did not say
	Images  []string  `json:"images"`
	Private bool      `json:"private"` // only some people (or nobody but the owner) can see it
	// PrivateKnown says whether the platform actually told us the audience.
	//
	// It is separate from Private because "the platform said this is public" and
	// "the platform did not say anything" are different answers, and treating the
	// second as the first is how a post with a limited audience turns into a
	// public one when it is replaced. When PrivateKnown is false, Private carries
	// no meaning and callers must not assume either way.
	PrivateKnown bool `json:"private_known"`
}
