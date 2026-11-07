package core

import (
	"context"
	"errors"
	"time"
)

// Social capabilities: a bot's own public timeline and its own avatar.
//
// These are optional Platform extensions, like ImageSender or BoardPoster, so
// platforms that cannot do them simply do not implement the interface and the
// management API answers "not supported" instead of the bridge guessing by
// platform name. Both write to the account itself (a 说说 is visible to other
// people, an avatar change is visible everywhere), so a platform must also
// require an explicit opt-in in its own options before doing either: the
// interface is a capability, not a permission.

// ErrSocialDisabled means the platform can do this but the bot's
// configuration has not opted in. Callers show it as "not turned on", never
// retry it, and never fall back to another path.
var ErrSocialDisabled = errors.New("social action not enabled in config")

// ErrSocialUnsupported means this bot's platform cannot do it at all (the
// account is on Discord, or the OneBot implementation lacks the extension).
var ErrSocialUnsupported = errors.New("platform does not support this action")

// Moment is one post on the bot's own timeline.
type Moment struct {
	ID      string    `json:"id"`   // platform id, used to delete or replace it; "" when unknown
	Text    string    `json:"text"` // the words, as posted
	Time    time.Time `json:"time"` // when it was posted; zero when the platform did not say
	Images  []string  `json:"images"`
	Private bool      `json:"private"` // only some people (or nobody but the owner) can see it
}

// MomentImage is one picture to attach to a post. Bytes rather than a path so
// the platform does not need to know the caller's filesystem.
type MomentImage struct {
	Data []byte
	Name string // file name, for logs only
}

// MomentPoster is an optional Platform extension for the bot's own timeline
// (QQ空间说说). Implementations must honour ctx and must not post anything the
// caller did not ask for: no retries, no scheduled posting.
type MomentPoster interface {
	// ListMoments returns the bot's own recent posts, newest first.
	ListMoments(ctx context.Context, limit int) ([]Moment, error)
	// PostMoment publishes text and pictures and returns the new post. A
	// non-nil error means the caller must not assume it was published; when
	// the post went out but its id is unknown, implementations return a
	// Moment with an empty ID and a nil error.
	PostMoment(ctx context.Context, text string, images []MomentImage) (Moment, error)
	// RemoveMoment deletes one of the bot's own posts by id. A post that is
	// already gone counts as removed.
	RemoveMoment(ctx context.Context, id string) error
}

// MomentReplacer is an optional refinement of MomentPoster: change the words
// of one existing post in a single call, instead of asking the caller to post
// a new one and delete the old one as two separate steps.
//
// QQ空间 has no "edit this post's text" upstream call, so an implementation may
// satisfy this by publishing the new text first and deleting the old post
// afterwards. That order is the point: a failure while publishing leaves the
// old post untouched, so the caller can never lose the words it already had.
// When the post is published but the old one cannot be deleted, implementations
// return the new Moment together with a non-nil error, and the caller must tell
// the person that both posts exist.
type MomentReplacer interface {
	// ReplaceMoment replaces post id with text/images and returns the post that
	// now carries the words. The returned Moment has an empty ID when the new
	// post went out but the platform did not say which one it is.
	ReplaceMoment(ctx context.Context, id, text string, images []MomentImage) (Moment, error)
}

// AvatarSetter is an optional Platform extension for changing the account's
// own avatar. The picture is passed as bytes for the same reason as above.
type AvatarSetter interface {
	SetAvatar(ctx context.Context, img ImageAttachment) error
}

// SocialCapabilities is what a platform reports about the actions above, so a
// panel can say "turned off in config" before anyone presses a button. It is
// separate from the interfaces because the interfaces answer "can this code
// do it at all", while this answers "is it turned on right now".
type SocialCapabilities struct {
	ListMoments    bool   `json:"list_moments"`
	PostMoment     bool   `json:"post_moment"`
	RemoveMoment   bool   `json:"remove_moment"`
	ReplaceMoment  bool   `json:"replace_moment"`
	SetAvatar      bool   `json:"set_avatar"`
	DisabledReason string `json:"disabled_reason,omitempty"` // why the false ones are false
}

// SocialCapabilityReporter is an optional refinement: a platform that
// implements MomentPoster/AvatarSetter but gates them behind config reports
// the current state here. Callers that get no reporter assume "supported
// whenever the interface is implemented".
type SocialCapabilityReporter interface {
	SocialCapabilities() SocialCapabilities
}
