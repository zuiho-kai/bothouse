import api from './client';

// QQ 说说 / 头像 (#150 第 c 项). These write as the account itself, so every one of
// them is gated by an explicit option in the project's qq config (allow_qzone /
// allow_avatar). The backend reports which are on; the panel only enables those
// buttons instead of letting someone press one and get a 403.
export interface SocialCapabilities {
  list_moments: boolean;
  post_moment: boolean;
  remove_moment: boolean;
  replace_moment: boolean;
  set_avatar: boolean;
  disabled_reason?: string;
}

export interface Moment {
  id: string;
  text: string;
  time: string;
  images: string[];
  private: boolean;
  /**
   * 上游到底说没说这条算谁可见。private 只有在 private_known 为 true 时才有意义：
   * 读不到这个字段是「不知道」，不是「公开」（见 platform/qq/social.go privateOf）。
   */
  private_known: boolean;
}

export type SocialStatus = 'ready' | 'off' | 'error' | 'not_supported';

export interface SocialState {
  status: SocialStatus;
  platform: string;
  capabilities: SocialCapabilities;
  moments: Moment[];
  message?: string;
}

export const getSocial = (project: string) => api.get<SocialState>(`/projects/${project}/social`);

/** Post one 说说. Publishes as the account: the panel asks first. */
export const postMoment = (project: string, text: string) =>
  api.post<{ moment: Moment }>(`/projects/${project}/social/moment`, { text });

/**
 * Replace one 说说 in a single call: new words first, old post only then removed.
 *
 * acceptAudienceChange is not a formality. Replacing publishes a new post — public
 * unless told otherwise — and deletes the old one; the old one's audience may have
 * been read wrongly (the upstream fills in "everyone" when it never read it), so the
 * person has to be shown that and agree. The backend answers 400 without it.
 */
export const replaceMoment = (
  project: string,
  id: string,
  text: string,
  acceptAudienceChange: boolean,
) =>
  api.post<{ moment: Moment }>(`/projects/${project}/social/moment/replace`, {
    id,
    text,
    accept_audience_change: acceptAudienceChange,
  });

/** Delete one of the bot's own 说说 by tid. */
export const deleteMoment = (project: string, id: string) =>
  api.post<{ result: string }>(`/projects/${project}/social/moment/delete`, { id });

/** Replace the account's avatar. Multipart because a picture does not belong in JSON. */
export const setAvatar = (project: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.form<{ result: string; mime: string; bytes: number }>(
    `/projects/${project}/social/avatar`,
    form,
  );
};
