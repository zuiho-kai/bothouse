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

// ErrSocialCannotReplace means the platform understood the request and refused it on
// purpose: the post cannot be replaced without changing something the person set (how
// many people can see it). It is the caller's mistake to have asked, not an upstream
// failure, so it maps to 400 rather than 502.
var ErrSocialCannotReplace = errors.New("this post cannot be replaced as it is")

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

// MomentImage is one picture to attach to a post.
//
// Data is the picture itself, so the platform does not need to know the
// caller's filesystem. URL is the alternative a replace uses: pictures read
// back from an existing post arrive as URLs on the platform's own CDN, and
// handing that URL back to the platform keeps the picture without this process
// downloading and re-uploading it. Exactly one of the two is set.
type MomentImage struct {
	Data []byte
	URL  string // a URL the platform can fetch itself (what ListMoments returns)
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
//
// This is NOT an atomic swap, and callers must not describe it as one. Three
// outcomes exist:
//
//  1. clean replace: the new post is out, the old one is gone, nil error.
//  2. publish failed: the old post is untouched; non-nil error, zero Moment.
//     Nothing was lost and nothing extra exists.
//  3. partial: the new post is out but the old one survives — the delete failed,
//     or the platform did not say which post the new one is (so nobody could
//     tidy up afterwards). Implementations return the new Moment together with
//     a non-nil error, and callers must both show the message and hand the new
//     Moment back so the person can see there are now two posts and remove one
//     deliberately. Retrying the same replace in this state publishes another
//     copy; callers must not offer that retry without a fresh list.
type MomentReplacer interface {
	// ReplaceMoment replaces post id with text and returns the one that now
	// carries the words.
	//
	// There is no images parameter on purpose. The parts of the old post that
	// change how it can be seen — its pictures, and whether it was limited to
	// some people — belong to the old post, and an implementation must read them
	// back itself: it is the only side that can. When it cannot read the old
	// post, or cannot reproduce those parts, it must fail before publishing
	// anything rather than publish a copy that silently lacks them, because the
	// old post is deleted afterwards. Comments, likes and the publish time do
	// not carry over; that is a known limit of replace, not a failure.
	//
	// The returned Moment has an empty ID when the new post went out but the
	// platform did not say which one it is; that is outcome 3 above, never a
	// clean replace.
	ReplaceMoment(ctx context.Context, id, text string) (Moment, error)
}

// MomentReplacePartialError means the replace did not finish cleanly but the new
// post is already out: the old post is still there too. It carries the new
// Moment so the caller can show it and let the person remove one deliberately.
// Callers must not treat it as "nothing happened" and must not retry blindly —
// a retry publishes yet another copy.
type MomentReplacePartialError struct {
	Moment Moment
	Err    error
}

func (e *MomentReplacePartialError) Error() string { return e.Err.Error() }

func (e *MomentReplacePartialError) Unwrap() error { return e.Err }

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
